/****************************************************************************
*
* Heimdall - a self documenting oData API Guardian for Express 
* (c)Copyright 2014, Max Iwin
* MIT License
*
****************************************************************************/

//Module dependencies
var fs    = require('fs');
 
//All valid resources loaded by Heimdall
var specifications = [];
var resources = [];
var routes    = [];

//Environment context set by Express
var env;


//Default security middleware, can override
var security  = {authenticate:function(req,res,next){next()},administrator:function(req,res,next){res.send(403)}};

//Formats an oData JSON response
var format = function(host,uri,type,records) {
	var __index = 0;
	var baseuri = "//" + host;
	var oData = {d:{
		__count : records.length,
		results : records.map(function(rec){
			rec.__metadata = rec.__metadata || {
				uri:baseuri+uri,
				type:type
			}
			rec.__index = rec.__index||(rec.__index++);
			return rec;
		})
	}};
	
	if (records.__prev) oData.d.__prev = records.__prev;
	if (records.__next) oData.d.__next = records.__next;
	
	return oData;
};

//Formats an oData JSON error response
var error = function(err,code,message,innererror) {
	code = (code||500).toString();
	message = message||"Internal Server Error";
	var oData = {error:{
			code : code,
			message : message,
			innererror : innererror||err
	}};
	
	if ('development' == env) {
		//Verbose console errors for development environments 
		console.error(oData.error);
	}
	
	return oData;
}

// --------------------------------------------------------------------------
// Heimdall Exports Object:
var Heimdall = module.exports = {oData:{Edm:{}}};

// --------------------------------------------------------------------------
// oData Edm DataType helper.  Used for validation and casting
var EdmType = Heimdall.oData.EdmType = function(type,validate,cast) {
	var self = this;
	self.type = type;
	self.validate = validate;
	self.cast = cast||function(val){return val;};
	Heimdall.oData.Edm[type] = function(description,required) {
		return new EdmClass(self,description,required);
	};
};

var EdmClass = function(edmtype,description,required) {
	var self = this;
	self.type = edmtype;
	self.description = description||edmtype.type;
	self.required = required?true:false;
};

// --------------------------------------------------------------------------
// Creates a heimdall route for a request
//  - Collects all predefined data into an object
//  - Ensures strict API definition
var route = function(name,type,method) {

	resources[name+'_'+type] = function(context,data,callback) {
		method.command.call(context, data, callback);
	};
	
	routes[name+'_'+type] = function(req,res,next) {

		var data = {};

		var check = function(specification,source) {
			var edm;
			for(var key in specification) {
				if (specification.hasOwnProperty(key) && (specification[key] instanceof EdmClass) && (source[key]||specification[key].required)) {
					edm = specification[key].type;
					if(edm.validate(source[key])) {
						data[key] = edm.cast(source[key]);
					} else {
						res.status(449).send(error("Type Error: '" + source[key] + "' is not a valid value for '" + key + "'",449,"Retry with " + edm.type))
						return false;
					}
				}
			}
			return true;
		}	

		if(method.query && !check(method.query,req.query)) return false;
		
		if(method.params && !check(method.params,req.params))  return false;

		if(method.body && !check(method.body,req.body)) return false;
		
		if(method.files && !check(method.files,req.files)) return false;

		//Add the session to the data
		for(var s in req.session) { if(req.session.hasOwnProperty(s) && s!=='cookie') data[s] = req.session[s]; }

		try {
			//Data object ready, call the resource command:
			resource(name, type, data, function(err,result) {
				if (err) {
					res.json(error(req.headers.host,req.url,name+'.'+type,err));
				} else if (req.heimdallchain) {
					req.heimdallchain = null;
					req.heimdall = format(req.headers.host,req.url,name+'.'+type,result);
					next();
				} else if (data.redirect) {
					res.redirect(data.redirect);
				} else if (req.route.path.indexOf('.html')===-1) {
					res.json(format(req.headers.host,req.url,name+'.'+type,result));
				} else {
					req.heimdall = format(req.headers.host,req.url,name+'.'+type,result);
					next();
				}
			});
		} catch (ex) {
			//Exception in resource command
			res.json(error(req.headers.host,req.url,"Internal Command Error",ex.toString()));			
		}
	};
	
	return routes[name+'_'+type];
	
};


// --------------------------------------------------------------------------
// Registers a heimdall-compliant API specification  
var documentresource = function(resource){
	return {
		__metadata:{
			uri:'/api/'+resource.name,
			type:'api.resource'
		},
		name:resource.name,
		description:resource.description,
		methods:[]
	}
}

// --------------------------------------------------------------------------
// Registers a heimdall-compliant API method specification  
var documentmethod = function(specification,verb,methodtype,method) {

	var url  = buildroutestring(specification.name,method);
	var type = specification.name + '.' + methodtype.toLowerCase();

	var doc = {verb:verb,description:method.description,url:url,type:type};

	verb = verb.toUpperCase();

	var inputspec = function(items) {
		var obj = method[items];
		if (obj) {
			var list = [];
			for (var o in obj) {
				if(obj.hasOwnProperty(o)) {
					list.push({
						key:o,
						type:obj[o].type.type,
						description:obj[o].description,
						required:obj[o].required
					});
				}
			}
			if(list.length) doc[items] = list;
		}
	};

	inputspec('params');
	inputspec('query');
	inputspec('body');
	inputspec('files');
	inputspec('fields');

	specification.methods.push(doc);
}


// --------------------------------------------------------------------------
// Creates API Documentation resources for all Heimdall-Compliant routes 
var documentation = function(app) {
	
	app.get("/api",function(req,res) {
		res.json(format(req.headers.host,req.url,'API.Resource',specifications));
	});

	app.get("/api/:name",function(req,res) {

		var spec = null;

		for(var i=0,l=specifications.length;i<l;i++) {
			if (specifications[i].name === req.params.name) {
				spec = specifications[i];
				break;
			}
		}
		
		if(spec) {
			res.json(format(req.headers.host,req.url,'API.Resource',[spec]));
		} else {
			res.status(404).send(error("The API resource specification '/api/" + req.params.name + "' could not be found, please check the URL and try again",404,"404 (not found)"));
		}

	});

}; 

// --------------------------------------------------------------------------
// Builds a url route string, based on accepted method params 
var buildroutestring = function(name,method) {
	var routestring = "/"+name+"/";
	for(var p in method.params) {
		if (method.params.hasOwnProperty(p)) {
			routestring += ":" + p + "/";
		}
	}
	return routestring + "?";
}

// --------------------------------------------------------------------------
// Builds an REST resource based on an API specification 
var buildmethodresource = function(name,resource,specification,verb,methodname,app) {
	var method = resource.api[methodname];
	var routestring = buildroutestring(name,method);
	var methodnamelc = methodname.toLowerCase();
	var verblc = verb.toLowerCase();

	documentmethod(specification,verb,methodname,method);

	if (method.open) {
		app[verblc](routestring, route(name,methodnamelc,method));
	} else 	if (method.admin) {
		app[verblc](routestring, security.administrator, route(name,methodnamelc,method));
	} else {  
		app[verblc](routestring, security.authenticate, route(name,methodnamelc,method));
	}
}

// --------------------------------------------------------------------------
// Expose heimdall resource calls for use by other modules 
var resource = Heimdall.resource = function(name,type,data,callback) {
	if (resources[name+'_'+type]) {
		resources[name+'_'+type]({name:name,type:type},data,callback);
	} else {
		var heimdall_resource_not_found = "ERROR - The Heimdall resource ["+name+"."+type+"] does not exist";
		console.error(heimdall_resource_not_found);
		callback(heimdall_resource_not_found);
	}
};

// --------------------------------------------------------------------------
// Middleware to set a querystring value or values 
var set = Heimdall.set = function(query) {
	return function(req,res,next) { 
		for(var key in query) { if(query.hasOwnProperty(key)) { req.query[key] = query[key]; } }
		next();
	}
};

// --------------------------------------------------------------------------
// Expose heimdall resource calls for use as connect/express middleware 
var middleware = Heimdall.middleware = function(name,type) {	
	if (routes[name+'_'+type]) {
		return routes[name+'_'+type];
	} else {
		var heimdall_middleware_not_found = "ERROR - The Heimdall route ["+name+"."+type+"] does not exist";
		throw new Error(heimdall_middleware_not_found);
	}	
};

// --------------------------------------------------------------------------
// Expose heimdall resource calls for use as connect/express middleware 
var chain = Heimdall.chain = function(name,type) {
	if (routes[name+'_'+type]) {
		return function(req,res,next) {
			req.heimdallchain = true;
			routes[name+'_'+type].call(this,req,res,next);
		}
	} else {
		var heimdall_chain_not_found = "ERROR - The Heimdall route ["+name+"."+type+"] does not exist";
		throw new Error(heimdall_chain_not_found);
	} 

};

// --------------------------------------------------------------------------
// Renders heimdall middleware oData to a view

//Get the expanded name of a view with req.params
var parseview = function(view,params) {
	if (view.indexOf(":")>-1) {
		for(var key in params) {
			if (params.hasOwnProperty(key)) {
				view = view.replace(":"+key, params[key]);
			}
		}
	}
	return view;
}

//Renders the view, after verifying the template exists
var renderview = function(req,res,view) {		

	//Inherit chained heimdall data
	var data = req.heimdall ? req.heimdall.d : {};

	//Add query data to the view object
	data.query = {};
	for(var key in req.query) {
		if(req.query.hasOwnProperty(key)) {
			data.query[key] = req.query[key];
		}
	}

	//Add session data to the view object
	data.session = {};
	for(var key in req.session) {
		if(req.session.hasOwnProperty(key) && key!= 'cookie') {
			data.session[key] = req.session[key];
		}
	}

	res.render(view,data);
}

//Cached template file existence
var templateexists = [];

//Public Heimdall render method 
var render = Heimdall.render = function(view) {

	return function(req,res){

		var notfound = function(){ res.send(404); }

		var viewname = parseview(view,req.params);
		
		if (templateexists[viewname] === true) {
			//template known to exist, render
			renderview(req,res,viewname);

		} else if (templateexists[viewname] === false) {
			//template known to not exist, 404
			notfound();

		} else {
			//check if template exists
			var filename = process.cwd()+'/views/'+viewname+'.jade';
			fs.exists(filename, function(exists) {

				if (exists) { 
					//Template exists!  Cache result and render
					templateexists[viewname]=true;
					renderview(req,res,viewname);

				} else {
					//Template does not exist!  Cache result and 404
					templateexists[viewname]=false;
					notfound(); 

				}
										
			});
		}
	}
}

// --------------------------------------------------------------------------
// Registers all the resources for a heimdall-compliant API specification 
var register = Heimdall.register = function(filename,resource,app) {
	if (typeof resource.name !== "string") { throw (new Error("Resource " + filename + " requires a name")); return false;}
	if (typeof resource.description !== "string") { throw (new Error("Resource " + name + " at " + filename + " requires a description")); return false;}
	if (typeof resource.api !== "object") { throw (new Error("Resource " + name + " at "  + filename + " requires an API definition")); return false;}
	var specification = documentresource(resource);
	for(var method in resource.api) {
		if(resource.api.hasOwnProperty(method)) {
			switch(method) {
				case 'ENTRY': buildmethodresource(resource.name,resource,specification,'GET',method,app); break;
				case 'COLLECTION': buildmethodresource(resource.name,resource,specification,'GET',method,app); break;
				case 'ADD': buildmethodresource(resource.name,resource,specification,'POST',method,app); break;
				case 'SAVE': buildmethodresource(resource.name,resource,specification,'PUT',method,app); break;
				case 'REMOVE': buildmethodresource(resource.name,resource,specification,'DELETE',method,app); break;
			}
		}
	}
	specifications.push(specification); 
};

// --------------------------------------------------------------------------
// Heimdall extended DataType creation method
//  params:
//    @datatype - the type object to create. Properties:
//              - "name"     - the name of the datatype  (required)
//				- "validate" - the validation function   (optional)
//				- "cast"     - the type casting function (optional)
var type = Heimdall.type = function(datatype) {
	
	var heimdall_type_not_found = "ERROR - A datatype was not provided";
	if(!datatype) throw new Error(heimdall_type_not_found);
	
	var heimdall_type_name_not_valid = "ERROR - The datatype does not have a valid name";
	if(typeof datatype.name !== 'string') throw new Error(heimdall_type_name_not_valid);
	
	var heimdall_type_exists = "ERROR - The datatype '"+datatype.name+"' already exists";
	if(Heimdall.oData.Edm[datatype.name]) throw new Error(heimdall_type_exists);
	
	var validate = (typeof datatype.validate === 'function') ? datatype.validate : function(){return true;};
	var cast = (typeof datatype.cast === 'function') ? datatype.cast     : function(val){return val;};
	
	new EdmType(datatype.name, validate, cast);	
	
}

// --------------------------------------------------------------------------
// Heimdall Main entry point
//  params:
//    @path - the absolute path to the API definition files
//    @app  - the express app
//    @auth - optional authentication middleware
var load = Heimdall.load = function(path,app,auth,admin) {

	if (typeof auth==='function') security.authenticate = auth;
	if (typeof admin==='function') security.administrator = admin;

	var revar = /\w+\.js$/i;
	var files = fs.readdirSync(path);
	var file, name, resource;
	for (var i=0,l=files.length;i<l;i++) {
		file = files[i];
		if (revar.test(file)) {
			console.log('Heimdall found API specification',file);	
			name = file.substr(0,file.indexOf(".js"));
			resource = require(path+name);
			register(path+name,resource,app);
		}
	}
	
	env = app.get('env');

	documentation(app);

	//Chain after load:
	return Heimdall;

}

//=============================================================================
//Declare default datatypes
var types = require('./datatypes').defaults;
for(var i=0,l=types.length;i<l;i++) type(types[i]);